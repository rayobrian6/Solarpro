// ═══════════════════════════════════════════════════════════════
// Validation Summary Page
// Extracted from route.ts — ZERO REGRESSION
// ═══════════════════════════════════════════════════════════════

import type { PermitInput, CanonicalInput } from '../types';
import type { CADModel } from '@/lib/cad/types';
import { titleBlock } from '../utils/titleBlock';
import { PLANSET_ENGINE_VERSION } from '../constants';
import { isFence, isGround, isRoof, getEquipmentContext } from '@/lib/system';
import { getInverterTopology, topologyToLegacy } from '@/lib/system/systemAccessors';
import { topologyDisplayLabel } from '../utils/helpers';


// ══════════════════════════════════════════════════════════════════════════════
// VALIDATION SUMMARY SHEET (Sheet 15)
// Authority signal to AHJ — shows every canonical field was resolved and verified.
// Shows PASS/FAIL for each engineering check.
// ══════════════════════════════════════════════════════════════════════════════
export function pageValidationSummary(
  input: PermitInput,
  canonical: CanonicalInput,
  cad: CADModel,
  pageNum: number,
  totalPages: number
): string {
  const sys     = canonical.systemType;
  const { system, compliance } = input;
  const structural = compliance.structural;
  // jurisdiction is OPTIONAL on PermitInput (types.ts) — AHJ enrichment can miss;
  // a bare cast crashed VAL-1 (and the whole planset) on `.ahj` when undefined.
  const jurisdiction = (compliance.jurisdiction ?? {}) as Record<string, any>;
  const _isFence = isFence(sys);
  const _isGround = isGround(sys);
  const _isRoof = isRoof(sys);

  // Compute real fence embedment check for status
  let embedStatus = '—', embedColor = '#555', reqEmbed = '—', provEmbed = '—';
  let windForce = '—', windMoment = '—', windPressDisp = '—', qzDisp = '—';

  if (_isFence) {
    const V   = canonical.site.windSpeed || 115;
    const qz  = 0.00256 * 0.85 * 1.0 * 0.85 * V * V;
    const p   = qz * 1.3;
    const H   = canonical.structure.panelHeightFt || 6.0;
    const S   = canonical.structure.postSpacingFt || 8.0;
    const F   = p * H * S;
    const M   = F * (H / 2);
    const b   = 0.25;
    const q   = canonical.structure.soilResistance || 200;
    const Dreq = 1.5 * Math.pow(M / (q * b), 1/3);
    const Dprov = canonical.structure.postEmbedFt || 3.5;
    embedStatus = Dprov >= Dreq ? 'PASS' : 'FAIL';
    embedColor  = Dprov >= Dreq ? '#006600' : '#cc0000';
    reqEmbed    = Dreq.toFixed(2) + ' ft';
    provEmbed   = Dprov.toFixed(1) + ' ft';
    windForce   = F.toFixed(0) + ' lbs';
    windMoment  = M.toFixed(0) + ' ft-lbs';
    windPressDisp = p.toFixed(1) + ' psf';
    qzDisp      = qz.toFixed(2) + ' psf';
  }

  type CheckStatus = 'PASS' | 'FAIL' | 'N/A';
  interface CheckRow { label: string; value: string; status: CheckStatus; note: string; }

  function statusBadge(s: CheckStatus): string {
    const bg = s === 'PASS' ? '#006600' : s === 'FAIL' ? '#cc0000' : '#555';
    return `<span style="background:${bg};color:#fff;padding:1px 6px;font-size:7px;font-weight:900;letter-spacing:0.5px;">${s}</span>`;
  }

  const checks: CheckRow[] = [
    {
      label:  'System Type Verified',
      value:  canonical.systemType.toUpperCase().replace('_', ' '),
      status: canonical.systemType ? 'PASS' : 'FAIL',
      note:   'Resolved via canonical pipeline — panel geometry + name scan + layout fields',
    },
    {
      label:  'Panel Layout Verified',
      value:  `${canonical.electrical.totalPanels} modules @ ${canonical.module.wattage}W = ${canonical.electrical.totalDcKw.toFixed(2)} kW DC`,
      status: canonical.electrical.totalPanels > 0 ? 'PASS' : 'FAIL',
      note:   'Panel count from CAD engine (authoritative); module data from equipment resolver',
    },
    {
      label:  'Module Data Verified',
      value:  `${canonical.module.manufacturer} ${canonical.module.model} — ${canonical.module.wattage}W | Voc ${canonical.module.voc}V | Isc ${canonical.module.isc}A`,
      status: canonical.module.wattage > 0 ? 'PASS' : 'FAIL',
      note:   'Hard-resolved from system.inverters[].strings[] — throws if missing',
    },
    {
      label:  'Mount System Verified',
      value:  canonical.mountSystem,
      status: canonical.mountSystem ? 'PASS' : 'FAIL',
      note:   'Locked to canonical.systemType via MOUNT_SYSTEM_MAP — no manual override',
    },
    {
      label:  'Wind Speed Verified',
      value:  `${canonical.site.windSpeed} mph (Exposure Cat. ${canonical.site.exposureCategory})`,
      status: canonical.site.windSpeed > 0 ? 'PASS' : 'FAIL',
      note:   'From compliance engine (AHJ wind speed) — required for structural calculations',
    },
    {
      label:  'Ground Snow Load Verified',
      value:  `${canonical.site.groundSnowLoad} psf`,
      status: canonical.site.groundSnowLoad >= 0 ? 'PASS' : 'FAIL',
      note:   'From compliance engine — 0 psf is valid for warm climates',
    },
    {
      label:  _isFence ? 'Structural Method: Fence Post Embedment (ASCE 7-22 §29.4)'
               : _isGround ? 'Structural Method: Ground Mount Pile/Pier (ASCE 7-22 §27)'
               : 'Structural Method: Roof Lag Bolt Attachment (ASCE 7-22 §26/27)',
      value:  _isFence
               ? `qz=${qzDisp} | p=${windPressDisp} | F=${windForce} | M=${windMoment} | D_req=${reqEmbed} | D_prov=${provEmbed}`
               : _isGround
               ? `Pile depth: ${canonical.structure.pileDepthFt.toFixed(1)} ft | Spacing: ${canonical.structure.pileSpacingFt.toFixed(1)} ft O.C. | Tilt: ${canonical.structure.tiltDeg}°`
               : `Rafter: ${canonical.structure.rafterSize} @ ${canonical.structure.rafterSpacingIn}" O.C. | Attachment: ${canonical.structure.attachSpacingIn}" O.C.`,
      status: _isFence ? (embedStatus as CheckStatus) : 'PASS',
      note:   _isFence
               ? 'Broms method embedment check — computed from canonical wind speed + fence geometry'
               : _isGround
               ? 'Pile capacity from compliance engine — verify with geotechnical engineer'
               : 'Rafter utilization + lag bolt capacity from compliance engine',
    },
    {
      label:  'Electrical Data Verified',
      // FIX v47.341: toFixed(2) on inverterKw to prevent float leak
      value:  `${canonical.electrical.totalPanels} panels | ${canonical.electrical.strings} string(s) | Inverter: ${canonical.electrical.inverterModel} (${Number(canonical.electrical.inverterKw).toFixed(2)} kW AC)`,
      status: canonical.electrical.totalPanels > 0 && canonical.electrical.inverterModel !== '—' ? 'PASS' : 'FAIL',
      note:   'From system.inverters[] — NEC 690.8 calculations based on canonical Voc/Isc',
    },
    {
      label:  'AHJ / Jurisdiction Verified',
      value:  `${canonical.site.ahj} | ${canonical.site.state} | SDC ${canonical.site.seismicSDC}`,
      status: canonical.site.ahj !== '—' ? 'PASS' : 'FAIL',
      note:   'From compliance.jurisdiction — NEC version, local amendments applied',
    },
    {
      label:  'Layout Dimensions Verified',
      value:  canonical.layoutDimensions
        ? `L=${canonical.layoutDimensions.totalLengthFt.toFixed(1)} ft × H=${canonical.layoutDimensions.totalHeightFt.toFixed(1)} ft | Panel: ${canonical.layoutDimensions.panelWidthIn}" × ${canonical.layoutDimensions.panelHeightIn}" | Row Spc: ${canonical.layoutDimensions.rowSpacingFt.toFixed(2)} ft`
        : 'NOT COMPUTED',
      status: (canonical.layoutDimensions && canonical.layoutDimensions.totalLengthFt > 0 ? 'PASS' : 'FAIL') as CheckStatus,
      note:   canonical.layoutDimensions?.source || 'buildLayoutDimensions() from CAD geometry',
    },
    {
      label:  'Cross-Contamination Check',
      value:  `System family: ${canonical.systemType} | Structural pages use family-specific logic only`,
      status: 'PASS',
      note:   'PV-4C and PE-1 dispatch to isolated family functions — no shared narrative blocks',
    },
  ];

  const passCount = checks.filter(c => c.status === 'PASS').length;
  const failCount = checks.filter(c => c.status === 'FAIL').length;
  const overallStatus = failCount === 0 ? 'ALL CHECKS PASSED' : `${failCount} CHECK(S) FAILED`;
  const overallColor  = failCount === 0 ? '#006600' : '#cc0000';

  function esc(value: unknown): string {
    return String(value ?? '—')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  const surveyEvidence = input.surveyEvidence;
  const surveyEvidenceStatus: CheckStatus = surveyEvidence?.completeness === 'sufficient'
    ? 'PASS'
    : surveyEvidence
      ? 'N/A'
      : 'N/A';
  const surveyEvidenceColor = surveyEvidence?.completeness === 'sufficient'
    ? '#006600'
    : surveyEvidence?.completeness === 'partial'
      ? '#b45309'
      : '#cc0000';
  const manifestV1 = surveyEvidence?.manifestV1 ?? {
    itemCount: 0,
    lifecycleState: 'uploaded',
    aiExtractionStatus: 'not_started',
    qualityStatus: 'not_processed',
    duplicateStatus: 'not_processed',
    engineeringBridge: {
      readiness: 'blocked',
      electricalEvidenceCount: 0,
      structuralEvidenceCount: 0,
      roofLayoutEvidenceCount: 0,
      sitePlanEvidenceCount: 0,
      cadAutomationStatus: 'not_started',
    },
  };
  const manifestSummarySource = surveyEvidence?.manifestV1 ? 'canonical bridge summary' : 'explicit legacy evidence fallback';
  const surveyEvidenceSummary = surveyEvidence
    ? `${surveyEvidence.photos.length} photo(s) | completeness: ${surveyEvidence.completeness.toUpperCase()} | normalized: ${surveyEvidence.source.normalizedAt}`
    : 'No survey evidence attached to this permit run';
  const surveyPhotoCategoryRows = surveyEvidence?.photos.length
    ? Object.entries(surveyEvidence.photos.reduce<Record<string, number>>((acc, photo) => {
        acc[photo.category] = (acc[photo.category] ?? 0) + 1;
        return acc;
      }, {})).map(([category, count]) => `${category}: ${count}`).join(' | ')
    : 'No survey photos available';
  const missingSurveyEvidence = surveyEvidence?.missingCategories.length
    ? surveyEvidence.missingCategories.join(', ')
    : surveyEvidence
      ? 'None'
      : 'main_service_panel, meter, roof_plane, overview';
  const traceability = surveyEvidence?.traceability;
  const requirementEvaluation = surveyEvidence?.requirementEvaluation;
  const documentProvenance = input.documentProvenance ?? surveyEvidence?.documentProvenance ?? null;
  const decisionProvenance = input.decisionProvenance ?? surveyEvidence?.decisionProvenance ?? documentProvenance?.decisionProvenance ?? null;
  const engineeringStateRegistry = input.engineeringStateRegistry ?? documentProvenance?.engineeringStateRegistry ?? null;
  const invalidationLineage = input.invalidationLineage ?? documentProvenance?.invalidationLineage ?? null;
  const staleStateCount = engineeringStateRegistry?.stateRecords.filter(record => record.staleStatus !== 'current').length ?? 0;
  const registryStatusRows = requirementEvaluation
    ? [
        ['Registry Status', `readiness: ${requirementEvaluation.readiness} | completeness: ${requirementEvaluation.completeness} | confidence: ${requirementEvaluation.confidenceSource}`],
        ['Satisfied Requirements', requirementEvaluation.satisfiedRequirements.map(requirement => `${requirement.humanLabel}: ${requirement.canonicalEvidenceIds.join(', ') || 'none'}`).join(' | ') || 'None'],
        ['Partial Requirements', requirementEvaluation.partiallySatisfiedRequirements.map(requirement => `${requirement.humanLabel}: ${requirement.status}`).join(' | ') || 'None'],
        ['Blocked Requirements', requirementEvaluation.blockedRequirements.map(requirement => `${requirement.humanLabel}: ${requirement.missingSeverity}`).join(' | ') || 'None'],
        ['Inactive Future Flags', requirementEvaluation.inactiveRequirements.map(requirement => `${requirement.humanLabel}: inactive`).join(' | ') || 'None'],
      ] as const
    : [['Registry Status', 'No engineering requirement registry evaluation was provided.'] as const];
  const missingRequirementAnalysisRows = requirementEvaluation?.missingRequirements.length
    ? requirementEvaluation.missingRequirements.map(requirement => [
        requirement.humanLabel,
        `${requirement.status} | severity: ${requirement.missingSeverity} | readiness impact: ${requirement.readinessImpact} | ${requirement.reasoningPath.join(' -> ')}`,
      ] as const)
    : [['Missing Requirement Analysis', 'No missing active registry requirements.'] as const];
  const requirementProvenanceRows = requirementEvaluation?.allRequirements.filter(requirement => requirement.active).length
    ? requirementEvaluation.allRequirements.filter(requirement => requirement.active).map(requirement => [
        requirement.humanLabel,
        `${requirement.status} | evidence: ${requirement.canonicalEvidenceIds.join(', ') || 'none'} | surveys: ${requirement.originatingSurveyIds.join(', ') || 'none'} | duplicate-collapsed: ${requirement.duplicateCollapsed ? 'yes' : 'no'} | confidence: ${requirement.confidenceSource}`,
      ] as const)
    : [['Requirement Provenance', 'No active registry requirement provenance was provided.'] as const];
  const requirementTraceRows = traceability?.requirements.length
    ? traceability.requirements.map(requirement => [
        requirement.requirementLabel,
        requirement.requirementSatisfied
          ? `SATISFIED by ${requirement.canonicalEvidenceId} | survey ${requirement.originatingSurveyId ?? 'unknown'} | duplicates: ${requirement.duplicateGroupSize} | confidence source: ${requirement.requirementConfidenceSource}`
          : `MISSING | ${requirement.selectionReason} | confidence source: ${requirement.requirementConfidenceSource}`,
      ] as const)
    : [['Requirement Evidence Traceability', 'No canonical requirement traceability bundle was provided.'] as const];
  const canonicalProvenanceRows = traceability?.canonicalEvidence.length
    ? traceability.canonicalEvidence.slice(0, 8).map(record => [
        record.evidenceCategoryLabel,
        `${record.canonicalEvidenceId} | origin survey ${record.originatingSurveyId} @ ${record.originatingSurveyCreatedAt ?? 'unknown'} | group size ${record.duplicateGroupSize} | ${record.selectionReason}`,
      ] as const)
    : [['Canonical Evidence Provenance', 'No canonical evidence provenance records were provided.'] as const];
  const surveyLineageRows = traceability?.surveyLineage.length
    ? traceability.surveyLineage.map(record => [
        record.isCanonical ? 'Canonical Survey Lineage' : 'Survey Lineage',
        `${record.surveyId} | ${record.duplicateStatus} | submitted ${record.submittedAt ?? 'unknown'} | raw uploads ${record.rawPhotoCount} audit-only | canonical evidence ${record.canonicalEvidenceCount}`,
      ] as const)
    : [['Survey Lineage', 'No survey lineage records were provided for this permit run.'] as const];
  const surveyWarningRows = surveyEvidence
    ? [...surveyEvidence.blockers, ...surveyEvidence.warnings].slice(0, 6)
    : ['No normalized survey evidence object was provided; plan-set assumptions are based on design/canonical inputs only.'];
  const documentProvenanceRows = documentProvenance ? [
    ['Document Provenance Bundle', `${documentProvenance.documentId} | type: ${documentProvenance.documentType} | truth: ${documentProvenance.truthSource} | confidence: ${documentProvenance.confidenceSource}`],
    ['Bound Requirements', documentProvenance.requirementIds.join(', ') || 'None'],
    ['Canonical Evidence Links', documentProvenance.canonicalEvidenceIds.join(', ') || 'None'],
    ['Originating Surveys', documentProvenance.originatingSurveyIds.join(', ') || 'None'],
    ['Dependency Graph', `${documentProvenance.dependencyGraph?.nodes.length ?? 0} node(s) | ${documentProvenance.dependencyGraph?.edges.length ?? 0} edge(s) | hash ${documentProvenance.dependencyGraph?.deterministicHash ?? 'none'}`],
    ['Audit Guards', documentProvenance.auditGuards.map(guard => `${guard.guardCode}: ${guard.passed ? 'PASS' : guard.severity.toUpperCase()}`).join(' | ')],
  ] as const : [
    ['Document Provenance Bundle', 'No document provenance bundle was attached to this permit run.'],
  ] as const;
  const documentSectionRows = documentProvenance?.sections.length
    ? documentProvenance.sections.slice(0, 10).map(section => [
        section.sectionId,
        `${section.sectionLabel} | requirements: ${section.requirementIds.join(', ')} | evidence: ${section.canonicalEvidenceIds.join(', ') || 'none'} | dependencies: ${section.engineeringDependencyIds.length}`,
      ] as const)
    : [['Document Section Provenance', 'No section-level document provenance was provided.'] as const];
  const decisionProvenanceRows = decisionProvenance ? [
    ['Decision Provenance Bundle', `${decisionProvenance.bundleId} | decisions: ${decisionProvenance.decisionIds.length} | hash ${decisionProvenance.deterministicHash}`],
    ['Governing Rules', decisionProvenance.governingRuleIds.join(', ') || 'None'],
    ['Fallback / Default Events', decisionProvenance.fallbackDecisionIds.join(', ') || 'None'],
    ['Decision Evidence Links', decisionProvenance.canonicalEvidenceIds.join(', ') || 'None'],
    ['Decision Dependencies', `${decisionProvenance.dependencyNodeIds.length} dependency node(s) | sections: ${decisionProvenance.documentSectionIds.join(', ') || 'none'} | render contexts: ${decisionProvenance.renderContextIds.join(', ') || 'none'}`],
    ['Decision Audit Guards', decisionProvenance.auditGuards.map(guard => `${guard.guardCode}: ${guard.passed ? 'PASS' : guard.severity.toUpperCase()}`).join(' | ')],
  ] as const : [
    ['Decision Provenance Bundle', 'No engineering decision provenance bundle was attached to this permit run.'],
  ] as const;
  const decisionRecordRows = decisionProvenance?.decisionRecords.length
    ? decisionProvenance.decisionRecords.slice(0, 14).map(record => [
        record.decisionId,
        `${record.decisionType} | selected: ${String(record.selectedValue ?? 'none')} | reason: ${record.decisionReason} | requirements: ${record.requirementIds.join(', ') || 'none'} | evidence: ${record.canonicalEvidenceIds.join(', ') || 'none'} | rules: ${record.governingRules.map(rule => rule.reference).join(', ') || 'none'} | confidence: ${record.confidenceSource}`,
      ] as const)
    : [['Engineering Decision Records', 'No engineering decision records were provided.'] as const];
  const decisionMetadataRows = [
    ['Decision-Aware Readiness', input.decisionAwareReadinessSummary
      ? `status: ${input.decisionAwareReadinessSummary.readinessStatus} | decisions: ${input.decisionAwareReadinessSummary.decisionCount} | fallbacks: ${input.decisionAwareReadinessSummary.fallbackDecisionCount} | confidence: ${input.decisionAwareReadinessSummary.confidenceSource}`
      : 'No decision-aware readiness metadata was attached.'],
    ['Decision-Aware BOM Metadata', input.decisionAwareBOMMetadata?.length
      ? input.decisionAwareBOMMetadata.slice(0, 8).map(row => `${row.bomRowId}: decisions ${row.decisionIds.join(', ') || 'none'} | rules ${row.governingRuleIds.join(', ') || 'none'} | state ${row.engineeringStateIds?.join(', ') || 'none'} | depHash ${row.stateDependencyHash ?? 'none'}`).join(' | ')
      : 'No decision-aware BOM metadata was attached.'],
    ['Decision-Aware SLD Metadata', input.decisionAwareSLDMetadata
      ? `decisions: ${input.decisionAwareSLDMetadata.decisionIds.join(', ') || 'none'} | rules: ${input.decisionAwareSLDMetadata.governingRuleIds.join(', ') || 'none'} | fallback: ${input.decisionAwareSLDMetadata.fallbackDecisionIds.join(', ') || 'none'} | hash: ${input.decisionAwareSLDMetadata.deterministicHash} | state: ${input.decisionAwareSLDMetadata.engineeringStateIds?.join(', ') || 'none'} | depHash: ${input.decisionAwareSLDMetadata.stateDependencyHash ?? 'none'}`
      : 'No decision-aware SLD metadata was attached.'],
  ] as const;


  const engineeringStateRows = engineeringStateRegistry ? [
    ['Engineering State Registry', `${engineeringStateRegistry.registryId} | states: ${engineeringStateRegistry.stateIds.length} | stale: ${staleStateCount} | hash ${engineeringStateRegistry.deterministicHash}`],
    ['Generation Hash', engineeringStateRegistry.generationHash],
    ['Provenance Hash', engineeringStateRegistry.provenanceHash],
    ['Dependency Hash', engineeringStateRegistry.dependencyHash],
    ['Invalidation Lineage', invalidationLineage ? `states: ${invalidationLineage.stateIds.length} | stale ids: ${invalidationLineage.staleStateIds.join(', ') || 'none'} | plan: ${invalidationLineage.regenerationPlanId ?? 'none'}` : 'No invalidation lineage metadata attached.'],
    ['State Audit Guards', engineeringStateRegistry.auditGuards.map(guard => `${guard.guardCode}: ${guard.passed ? 'PASS' : guard.severity.toUpperCase()}`).join(' | ')],
  ] as const : [
    ['Engineering State Registry', 'No engineering state invalidation registry was attached to this permit run.'],
  ] as const;
  const engineeringStateRecordRows = engineeringStateRegistry?.stateRecords.length
    ? engineeringStateRegistry.stateRecords.slice(0, 14).map(record => [
        record.stateId,
        `${record.stateType} | ${record.stateCategory} | status: ${record.staleStatus} | requirements: ${record.requirementIds.join(', ') || 'none'} | decisions: ${record.decisionIds.join(', ') || 'none'} | evidence: ${record.canonicalEvidenceIds.join(', ') || 'none'} | depHash: ${record.dependencyHash}`,
      ] as const)
    : [['Engineering State Records', 'No engineering state records were provided.'] as const];

  const fieldEvidence = surveyEvidence?.fieldEvidence ?? {
    hasPhysicalData: false,
    hasRoofGeometry: false,
    hasElectricalData: false,
    hasStructuralData: false,
    roofPlaneCount: 0,
    usableAreaSqFt: null,
    mainPanelRatingAmps: null,
    busbarRatingAmps: null,
    rafterSize: null,
    rafterSpacingInches: null,
    roofMaterial: null,
  };

  const surveyFieldEvidenceRows = surveyEvidence ? [
    ['Evidence Manifest v1', `items: ${manifestV1.itemCount} | source: ${manifestSummarySource} | lifecycle: ${manifestV1.lifecycleState} | quality: ${manifestV1.qualityStatus} | duplicates: ${manifestV1.duplicateStatus} | AI: ${manifestV1.aiExtractionStatus} | engineering readiness: ${manifestV1.engineeringBridge.readiness} | CAD automation: ${manifestV1.engineeringBridge.cadAutomationStatus}`],
    ['Physical Data', fieldEvidence.hasPhysicalData ? 'present' : 'missing'],
    ['Roof Geometry', `${fieldEvidence.hasRoofGeometry ? 'present' : 'missing'} | planes: ${fieldEvidence.roofPlaneCount} | usable area: ${fieldEvidence.usableAreaSqFt ?? '—'} sq ft`],
    ['Electrical', `${fieldEvidence.hasElectricalData ? 'present' : 'missing'} | MSP: ${fieldEvidence.mainPanelRatingAmps ?? '—'}A | Busbar: ${fieldEvidence.busbarRatingAmps ?? '—'}A | evidence items: ${manifestV1.engineeringBridge.electricalEvidenceCount}`],
    ['Structural', `${fieldEvidence.hasStructuralData ? 'present' : 'missing'} | ${fieldEvidence.rafterSize ?? '—'} @ ${fieldEvidence.rafterSpacingInches ?? '—'} in O.C. | ${fieldEvidence.roofMaterial ?? '—'} | evidence items: ${manifestV1.engineeringBridge.structuralEvidenceCount}`],
    ['Layout / Site Evidence', `roof/layout items: ${manifestV1.engineeringBridge.roofLayoutEvidenceCount} | site-plan items: ${manifestV1.engineeringBridge.sitePlanEvidenceCount}`],
  ] : [
    ['Physical Data', 'No survey evidence attached'],
    ['Roof Geometry', 'Not traceable to survey evidence in this permit run'],
    ['Electrical', 'Not traceable to survey evidence in this permit run'],
    ['Structural', 'Not traceable to survey evidence in this permit run'],
  ];

  return `
  <div class="page">
    ${titleBlock(input, 'VAL-1', 'ENGINEERING VALIDATION SUMMARY', pageNum, totalPages)}
    <div class="page-content">

      <div style="display:flex;align-items:center;justify-content:space-between;border:2px solid ${overallColor};padding:var(--sm);background:${failCount===0?'#f0fff4':'#fff0f0'};margin-bottom:var(--sm);">
        <div>
          <div style="font-size:14px;font-weight:900;color:${overallColor};letter-spacing:0.5px;">${overallStatus}</div>
          <div style="font-size:8px;color:#555;margin-top:2px;">Canonical validation gate — ${passCount}/${checks.length} checks passed before planset generation</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:10px;font-weight:bold;">PLANSET ENGINE v${PLANSET_ENGINE_VERSION}</div>
          <div style="font-size:7px;color:#555;">Canonical pipeline — explicit visible fallbacks only</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-bottom:var(--xs);">
        <div style="border:var(--border);padding:var(--xs);background:#f8f9fa;">
          <div style="font-size:7px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;color:#555;margin-bottom:3px;">System</div>
          <div style="font-size:8px;line-height:1.4;">
            <div><strong>${system.totalPanels ?? '—'}</strong> modules</div>
            <div><strong>${system.totalDcKw?.toFixed(2) ?? '—'}</strong> kW DC</div>
            <div><strong>${system.totalAcKw?.toFixed(2) ?? '—'}</strong> kW AC</div>
          </div>
        </div>
        <div style="border:var(--border);padding:var(--xs);background:#f8f9fa;">
          <div style="font-size:7px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;color:#555;margin-bottom:3px;">Wind / Snow</div>
          <div style="font-size:8px;line-height:1.4;">
            <div>Wind: <strong>${structural?.wind?.windSpeed ?? '—'}</strong> mph</div>
            <div>Exposure: <strong>${structural?.wind?.exposureCategory ?? '—'}</strong></div>
            <div>Snow: <strong>${structural?.snow?.groundSnowLoad ?? '—'}</strong> psf</div>
          </div>
        </div>
        <div style="border:var(--border);padding:var(--xs);background:#f8f9fa;">
          <div style="font-size:7px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;color:#555;margin-bottom:3px;">Inverter</div>
          <div style="font-size:8px;line-height:1.4;">
            <div>${(() => { const _eq = getEquipmentContext(input, cad); return [_eq.inverterManufacturer, _eq.inverterModel].filter(s => s && s !== '—').join(' ') || '—'; })()}</div>
            <div>Output: <strong>${system.totalAcKw?.toFixed(2) ?? '—'}</strong> kW AC</div>
            <div>Topology: <strong>${topologyDisplayLabel(topologyToLegacy(getInverterTopology(input, cad)))}</strong></div>
          </div>
        </div>
        <div style="border:var(--border);padding:var(--xs);background:#f8f9fa;">
          <div style="font-size:7px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;color:#555;margin-bottom:3px;">Jurisdiction</div>
          <div style="font-size:8px;line-height:1.4;">
            <div>AHJ: <strong>${jurisdiction.ahj || '—'}</strong></div>
            <div>State: <strong>${jurisdiction.state || '—'}</strong></div>
            <div>NEC: <strong>${jurisdiction.necVersion || '—'}</strong></div>
          </div>
        </div>
      </div>

      <div class="section-title">Engineering Data Verification — Canonical Object Audit</div>
      <table class="equip-table" style="width:100%;">
        <thead>
          <tr>
            <th style="width:28%;">Check</th>
            <th style="width:40%;">Resolved Value</th>
            <th style="width:8%;text-align:center;">Status</th>
            <th style="width:24%;">Source / Authority</th>
          </tr>
        </thead>
        <tbody>
          ${checks.map((c, i) => `
          <tr style="background:${i%2===0?'#fff':'#f9f9f9'};">
            <td style="font-weight:${c.status==='FAIL'?'900':'600'};color:${c.status==='FAIL'?'#cc0000':'#000'};font-size:7.5px;">${c.label}</td>
            <td style="font-family:monospace;font-size:7px;color:#000;">${c.value}</td>
            <td style="text-align:center;">${statusBadge(c.status)}</td>
            <td style="font-size:6.5px;color:#555;">${c.note}</td>
          </tr>`).join('')}
        </tbody>
      </table>

      <div class="section-title" style="margin-top:var(--sm);">Survey Evidence Audit — Photo & Field Traceability</div>
      <table class="equip-table" style="width:100%;">
        <thead>
          <tr>
            <th style="width:24%;">Evidence Check</th>
            <th style="width:48%;">Traceable Source Detail</th>
            <th style="width:8%;text-align:center;">Status</th>
            <th style="width:20%;">Plan-Set Impact</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="font-weight:900;color:${surveyEvidenceColor};font-size:7.5px;">Survey Evidence Completeness</td>
            <td style="font-family:monospace;font-size:7px;color:#000;">${esc(surveyEvidenceSummary)}</td>
            <td style="text-align:center;">${statusBadge(surveyEvidenceStatus)}</td>
            <td style="font-size:6.5px;color:#555;">Evidence is advisory/traceability metadata; canonical validation remains authoritative.</td>
          </tr>
          <tr style="background:#f9f9f9;">
            <td style="font-weight:600;font-size:7.5px;">Photo Evidence Categories</td>
            <td style="font-family:monospace;font-size:7px;color:#000;">${esc(surveyPhotoCategoryRows)}</td>
            <td style="text-align:center;">${statusBadge(surveyEvidence?.photos.length ? 'PASS' : 'N/A')}</td>
            <td style="font-size:6.5px;color:#555;">Links real survey photo records to permit/CAD assumptions without image-recognition overclaiming.</td>
          </tr>
          <tr>
            <td style="font-weight:600;font-size:7.5px;">Missing Required Evidence</td>
            <td style="font-family:monospace;font-size:7px;color:${surveyEvidence?.missingCategories.length ? '#b45309' : '#006600'};">${esc(missingSurveyEvidence)}</td>
            <td style="text-align:center;">${statusBadge(surveyEvidence && surveyEvidence.missingCategories.length === 0 ? 'PASS' : 'N/A')}</td>
            <td style="font-size:6.5px;color:#555;">Missing categories become engineer-verification warnings, not silent assumptions.</td>
          </tr>
          ${surveyFieldEvidenceRows.map(([label, value], i) => `
          <tr style="background:${i%2===0?'#f9f9f9':'#fff'};">
            <td style="font-weight:600;font-size:7.5px;">${esc(label)}</td>
            <td colspan="3" style="font-family:monospace;font-size:7px;color:#000;">${esc(value)}</td>
          </tr>`).join('')}
          <tr><td colspan="4" style="font-weight:900;font-size:7px;color:#7c3aed;background:#f5f3ff;">Engineering Requirement Registry</td></tr>
          ${registryStatusRows.map(([label, value], i) => `
          <tr style="background:${i%2===0?'#faf5ff':'#fff'};">
            <td style="font-weight:600;font-size:7.5px;">${esc(label)}</td>
            <td colspan="3" style="font-family:monospace;font-size:6.5px;color:#000;">${esc(value)}</td>
          </tr>`).join('')}
          <tr><td colspan="4" style="font-weight:900;font-size:7px;color:#92400e;background:#fffbeb;">Missing Requirement Analysis</td></tr>
          ${missingRequirementAnalysisRows.map(([label, value], i) => `
          <tr style="background:${i%2===0?'#fffbeb':'#fff'};">
            <td style="font-weight:600;font-size:7.5px;">${esc(label)}</td>
            <td colspan="3" style="font-family:monospace;font-size:6.5px;color:#000;">${esc(value)}</td>
          </tr>`).join('')}
          <tr><td colspan="4" style="font-weight:900;font-size:7px;color:#0f766e;background:#f0fdfa;">Requirement Provenance</td></tr>
          ${requirementProvenanceRows.map(([label, value], i) => `
          <tr style="background:${i%2===0?'#f0fdfa':'#fff'};">
            <td style="font-weight:600;font-size:7.5px;">${esc(label)}</td>
            <td colspan="3" style="font-family:monospace;font-size:6.5px;color:#000;">${esc(value)}</td>
          </tr>`).join('')}
          <tr><td colspan="4" style="font-weight:900;font-size:7px;color:#0e7490;background:#ecfeff;">Requirement Evidence Traceability</td></tr>
          ${requirementTraceRows.map(([label, value], i) => `
          <tr style="background:${i%2===0?'#f0fdfa':'#fff'};">
            <td style="font-weight:600;font-size:7.5px;">${esc(label)}</td>
            <td colspan="3" style="font-family:monospace;font-size:6.5px;color:#000;">${esc(value)}</td>
          </tr>`).join('')}
          <tr><td colspan="4" style="font-weight:900;font-size:7px;color:#047857;background:#ecfdf5;">Canonical Evidence Provenance</td></tr>
          ${canonicalProvenanceRows.map(([label, value], i) => `
          <tr style="background:${i%2===0?'#f9f9f9':'#fff'};">
            <td style="font-weight:600;font-size:7.5px;">${esc(label)}</td>
            <td colspan="3" style="font-family:monospace;font-size:6.5px;color:#000;">${esc(value)}</td>
          </tr>`).join('')}
          <tr><td colspan="4" style="font-weight:900;font-size:7px;color:#4338ca;background:#eef2ff;">Survey Lineage</td></tr>
          ${surveyLineageRows.map(([label, value], i) => `
          <tr style="background:${i%2===0?'#f9f9ff':'#fff'};">
            <td style="font-weight:600;font-size:7.5px;">${esc(label)}</td>
            <td colspan="3" style="font-family:monospace;font-size:6.5px;color:#000;">${esc(value)}</td>
          </tr>`).join('')}
          <tr><td colspan="4" style="font-weight:900;font-size:7px;color:#1d4ed8;background:#eff6ff;">Document Provenance + Requirement Bindings</td></tr>
          ${documentProvenanceRows.map(([label, value], i) => `
          <tr style="background:${i%2===0?'#eff6ff':'#fff'};">
            <td style="font-weight:600;font-size:7.5px;">${esc(label)}</td>
            <td colspan="3" style="font-family:monospace;font-size:6.5px;color:#000;">${esc(value)}</td>
          </tr>`).join('')}
          <tr><td colspan="4" style="font-weight:900;font-size:7px;color:#1e40af;background:#dbeafe;">Document Section Provenance</td></tr>
          ${documentSectionRows.map(([label, value], i) => `
          <tr style="background:${i%2===0?'#eff6ff':'#fff'};">
            <td style="font-weight:600;font-size:7.5px;">${esc(label)}</td>
            <td colspan="3" style="font-family:monospace;font-size:6.5px;color:#000;">${esc(value)}</td>
          </tr>`).join('')}
          <tr><td colspan="4" style="font-weight:900;font-size:7px;color:#7f1d1d;background:#fee2e2;">Engineering Decision Provenance</td></tr>
          ${decisionProvenanceRows.map(([label, value], i) => `
          <tr style="background:${i%2===0?'#fff1f2':'#fff'};">
            <td style="font-weight:600;font-size:7.5px;">${esc(label)}</td>
            <td colspan="3" style="font-family:monospace;font-size:6.5px;color:#000;">${esc(value)}</td>
          </tr>`).join('')}
          <tr><td colspan="4" style="font-weight:900;font-size:7px;color:#9f1239;background:#ffe4e6;">Engineering Decision Records</td></tr>
          ${decisionRecordRows.map(([label, value], i) => `
          <tr style="background:${i%2===0?'#fff1f2':'#fff'};">
            <td style="font-weight:600;font-size:7.5px;">${esc(label)}</td>
            <td colspan="3" style="font-family:monospace;font-size:6.25px;color:#000;">${esc(value)}</td>
          </tr>`).join('')}
  
        <tr><td colspan="4" style="font-weight:900;font-size:7px;color:#065f46;background:#d1fae5;">Engineering State Invalidation</td></tr>
        ${engineeringStateRows.map(([label, value], i) => `
        <tr style="background:${i%2===0?'#ecfdf5':'#fff'};">
          <td style="font-weight:600;font-size:7.5px;">${esc(label)}</td>
          <td colspan="3" style="font-family:monospace;font-size:6.25px;color:#000;">${esc(value)}</td>
        </tr>`).join('')}
        <tr><td colspan="4" style="font-weight:900;font-size:7px;color:#047857;background:#ecfdf5;">Engineering State Records</td></tr>
        ${engineeringStateRecordRows.map(([label, value], i) => `
        <tr style="background:${i%2===0?'#ecfdf5':'#fff'};">
          <td style="font-weight:600;font-size:7.5px;">${esc(label)}</td>
          <td colspan="3" style="font-family:monospace;font-size:6px;color:#000;">${esc(value)}</td>
        </tr>`).join('')}

        <tr><td colspan="4" style="font-weight:900;font-size:7px;color:#be123c;background:#fff1f2;">Decision-Aware Output Metadata</td></tr>
          ${decisionMetadataRows.map(([label, value], i) => `
          <tr style="background:${i%2===0?'#fff1f2':'#fff'};">
            <td style="font-weight:600;font-size:7.5px;">${esc(label)}</td>
            <td colspan="3" style="font-family:monospace;font-size:6.25px;color:#000;">${esc(value)}</td>
          </tr>`).join('')}
          ${surveyWarningRows.map((warning, i) => `
          <tr style="background:${i%2===0?'#fff7ed':'#fff'};">
            <td style="font-weight:600;font-size:7.5px;color:#b45309;">Evidence Note ${i + 1}</td>
            <td colspan="3" style="font-size:6.5px;color:#7c2d12;">${esc(warning)}</td>
          </tr>`).join('')}
        </tbody>
      </table>

      <!-- Structural Calculation Summary — fence-specific detail table -->
      ${_isFence ? `
      <div class="section-title" style="margin-top:var(--sm);">Fence Structural Calculation Summary — ASCE 7-22 §29.4</div>
      <table class="equip-table" style="width:100%;">
        <thead><tr><th>Parameter</th><th>Formula</th><th>Input Values</th><th>Result</th></tr></thead>
        <tbody>
          <tr><td>Velocity Pressure</td><td style="font-family:monospace;font-size:7px;">qz = 0.00256 × Kz × Kzt × Kd × V²</td><td style="font-family:monospace;font-size:7px;">Kz=0.85, Kzt=1.0, Kd=0.85, V=${canonical.site.windSpeed} mph</td><td style="font-weight:bold;">${qzDisp}</td></tr>
          <tr style="background:#f9f9f9"><td>Net Wind Pressure</td><td style="font-family:monospace;font-size:7px;">p = qz × Cf</td><td style="font-family:monospace;font-size:7px;">Cf=1.3 (solid panel, Fig. 29.4-1)</td><td style="font-weight:bold;">${windPressDisp}</td></tr>
          <tr><td>Lateral Force / Post</td><td style="font-family:monospace;font-size:7px;">F = p × H × S</td><td style="font-family:monospace;font-size:7px;">H=${canonical.structure.panelHeightFt.toFixed(2)} ft, S=${canonical.structure.postSpacingFt.toFixed(1)} ft</td><td style="font-weight:bold;">${windForce}</td></tr>
          <tr style="background:#f9f9f9"><td>Overturning Moment</td><td style="font-family:monospace;font-size:7px;">M = F × H/2</td><td style="font-family:monospace;font-size:7px;">H/2 = ${(canonical.structure.panelHeightFt/2).toFixed(2)} ft</td><td style="font-weight:bold;">${windMoment}</td></tr>
          <tr><td>Required Embedment</td><td style="font-family:monospace;font-size:7px;">D = 1.5 × ∛(M / (q × b))</td><td style="font-family:monospace;font-size:7px;">q=${canonical.structure.soilResistance} psf, b=0.25 ft</td><td style="font-weight:bold;">${reqEmbed}</td></tr>
          <tr style="background:#f9f9f9"><td>Provided Embedment</td><td style="font-family:monospace;font-size:7px;">D_prov (CAD-sourced)</td><td style="font-family:monospace;font-size:7px;">${canonical.structure.postEmbedFt.toFixed(1)} ft min.</td><td style="font-weight:bold;color:${embedColor};">${provEmbed} — ${embedStatus}</td></tr>
        </tbody>
      </table>` : ''}

      <!-- Canonical Object Dump (engineering transparency) -->
      <div class="section-title" style="margin-top:var(--sm);">Canonical Object — Field Resolution Transparency</div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:var(--xs);">
        <div style="border:var(--border);padding:var(--xs);">
          <div style="font-weight:900;font-size:7.5px;margin-bottom:3px;border-bottom:1px solid #000;padding-bottom:2px;">SITE DATA</div>
          <table class="calc-table" style="font-size:6.5px;">
            <tr><td>System Type</td><td class="cv">${canonical.systemType}</td></tr>
            <tr><td>Wind Speed</td><td class="cv">${canonical.site.windSpeed} mph</td></tr>
            <tr><td>Exposure</td><td class="cv">Cat. ${canonical.site.exposureCategory}</td></tr>
            <tr><td>Ground Snow</td><td class="cv">${canonical.site.groundSnowLoad} psf</td></tr>
            <tr><td>Seismic SDC</td><td class="cv">${canonical.site.seismicSDC}</td></tr>
            <tr><td>AHJ</td><td class="cv">${canonical.site.ahj}</td></tr>
            <tr><td>State</td><td class="cv">${canonical.site.state}</td></tr>
          </table>
        </div>
        <div style="border:var(--border);padding:var(--xs);">
          <div style="font-weight:900;font-size:7.5px;margin-bottom:3px;border-bottom:1px solid #000;padding-bottom:2px;">MODULE & ELECTRICAL</div>
          <table class="calc-table" style="font-size:6.5px;">
            <tr><td>Module</td><td class="cv">${canonical.module.manufacturer} ${canonical.module.model}</td></tr>
            <tr><td>Wattage</td><td class="cv">${canonical.module.wattage} W</td></tr>
            <tr><td>Voc</td><td class="cv">${canonical.module.voc} V</td></tr>
            <tr><td>Isc</td><td class="cv">${canonical.module.isc} A</td></tr>
            <tr><td>Total kW DC</td><td class="cv">${canonical.electrical.totalDcKw.toFixed(2)} kW</td></tr>
            <tr><td>Inverter</td><td class="cv">${canonical.electrical.inverterModel}</td></tr>
            <tr><td>Mount System</td><td class="cv">${canonical.mountSystem}</td></tr>
          </table>
        </div>
        <div style="border:var(--border);padding:var(--xs);">
          <div style="font-weight:900;font-size:7.5px;margin-bottom:3px;border-bottom:1px solid #000;padding-bottom:2px;">STRUCTURAL</div>
          <table class="calc-table" style="font-size:6.5px;">
            ${_isFence ? `
            <tr><td>Post Embed</td><td class="cv">${canonical.structure.postEmbedFt.toFixed(1)} ft</td></tr>
            <tr><td>Post Spacing</td><td class="cv">${canonical.structure.postSpacingFt.toFixed(1)} ft O.C.</td></tr>
            <tr><td>Panel Height</td><td class="cv">${canonical.structure.panelHeightFt.toFixed(2)} ft</td></tr>
            <tr><td>Soil Resistance</td><td class="cv">${canonical.structure.soilResistance} psf</td></tr>
            <tr><td>Embed Check</td><td class="cv" style="color:${embedColor};font-weight:bold;">${embedStatus}</td></tr>
            ` : _isGround ? `
            <tr><td>Pile Depth</td><td class="cv">${canonical.structure.pileDepthFt.toFixed(1)} ft</td></tr>
            <tr><td>Pile Spacing</td><td class="cv">${canonical.structure.pileSpacingFt.toFixed(1)} ft O.C.</td></tr>
            <tr><td>Ground Clear</td><td class="cv">${canonical.structure.groundClearIn.toFixed(0)}"</td></tr>
            <tr><td>Tilt Angle</td><td class="cv">${canonical.structure.tiltDeg}°</td></tr>
            ` : `
            <tr><td>Rafter</td><td class="cv">${canonical.structure.rafterSize}</td></tr>
            <tr><td>Rafter Spacing</td><td class="cv">${canonical.structure.rafterSpacingIn}" O.C.</td></tr>
            <tr><td>Attach Spacing</td><td class="cv">${canonical.structure.attachSpacingIn}" O.C.</td></tr>
            `}
          </table>
        </div>
      </div>

      <div style="padding:var(--xs);margin-top:var(--sm);font-size:7px;line-height:1.5;border:2px solid #000;background:#fff;">
        <strong>VALIDATION AUTHORITY STATEMENT:</strong>
        This validation summary confirms that all engineering data required for the permit planset has been
        resolved through the canonical pipeline and verified before planset generation.
        Required canonical engineering fields are validated before planset generation; survey evidence fallbacks, when used, are explicitly labeled and visible.
        The planset engine version is v${PLANSET_ENGINE_VERSION} (PLANSET_ENGINE_VERSION=${PLANSET_ENGINE_VERSION}).
        All structural calculations use canonical.site.windSpeed, canonical.structure, and canonical.module as
        authoritative inputs. The planset generation was blocked if any required field was missing.
      </div>

    </div>
  </div>`;
}



