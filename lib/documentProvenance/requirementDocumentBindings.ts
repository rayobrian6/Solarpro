import type { RequirementDocumentBinding } from './types';
import type { EngineeringRequirementId } from '@/lib/survey/evidence/engineeringRequirements';
import { ENGINEERING_REQUIREMENT_REGISTRY } from '@/lib/survey/evidence/engineeringRequirements';

const baseSections: Record<EngineeringRequirementId, RequirementDocumentBinding['boundDocumentSections']> = {
  main_service_panel: [
    { documentType: 'permit_validation_sheet', sectionId: 'VAL-1.registry', sectionLabel: 'Registry Status' },
    { documentType: 'permit_sheet', sectionId: 'E-1.interconnection', sectionLabel: 'Electrical Interconnection Notes' },
    { documentType: 'single_line_diagram', sectionId: 'SLD.service-equipment', sectionLabel: 'Service Equipment Context' },
  ],
  utility_meter: [
    { documentType: 'permit_validation_sheet', sectionId: 'VAL-1.registry', sectionLabel: 'Registry Status' },
    { documentType: 'permit_sheet', sectionId: 'E-1.utility-meter', sectionLabel: 'Utility Meter / Interconnection Context' },
    { documentType: 'single_line_diagram', sectionId: 'SLD.utility-meter', sectionLabel: 'Utility Meter Node' },
  ],
  roof_overview: [
    { documentType: 'permit_validation_sheet', sectionId: 'VAL-1.registry', sectionLabel: 'Registry Status' },
    { documentType: 'permit_sheet', sectionId: 'PV-1.site-verification', sectionLabel: 'Site Verification' },
    { documentType: 'permit_sheet', sectionId: 'PV-2.layout-verification', sectionLabel: 'Array Layout Verification' },
    { documentType: 'plan_set', sectionId: 'PV-2.layout-context', sectionLabel: 'Plan Set Layout Context' },
  ],
  attic_access: [
    { documentType: 'permit_validation_sheet', sectionId: 'VAL-1.registry', sectionLabel: 'Registry Status' },
    { documentType: 'permit_sheet', sectionId: 'PV-3.structural-review', sectionLabel: 'Structural Review Notes' },
  ],
  subpanel: [
    { documentType: 'permit_validation_sheet', sectionId: 'VAL-1.registry', sectionLabel: 'Registry Status' },
    { documentType: 'permit_sheet', sectionId: 'E-1.optional-subpanel', sectionLabel: 'Optional Subpanel Notes' },
  ],
  main_disconnect: [
    { documentType: 'permit_validation_sheet', sectionId: 'VAL-1.registry', sectionLabel: 'Registry Status' },
    { documentType: 'permit_sheet', sectionId: 'E-1.disconnect', sectionLabel: 'Disconnect Notes' },
    { documentType: 'single_line_diagram', sectionId: 'SLD.disconnect', sectionLabel: 'Disconnect Context' },
  ],
  structural_access: [
    { documentType: 'permit_validation_sheet', sectionId: 'VAL-1.registry', sectionLabel: 'Registry Status' },
    { documentType: 'permit_sheet', sectionId: 'PV-3.structural-access', sectionLabel: 'Structural Access Notes' },
  ],
  utility_bill: [
    { documentType: 'permit_validation_sheet', sectionId: 'VAL-1.inactive-future', sectionLabel: 'Inactive Future Requirement Flags' },
  ],
  placards: [
    { documentType: 'permit_validation_sheet', sectionId: 'VAL-1.inactive-future', sectionLabel: 'Inactive Future Requirement Flags' },
    { documentType: 'permit_sheet', sectionId: 'PV-5.labels', sectionLabel: 'Warning Labels and Placards' },
  ],
  rapid_shutdown: [
    { documentType: 'permit_validation_sheet', sectionId: 'VAL-1.inactive-future', sectionLabel: 'Inactive Future Requirement Flags' },
    { documentType: 'permit_sheet', sectionId: 'PV-5.rapid-shutdown-notes', sectionLabel: 'Rapid Shutdown Notes' },
    { documentType: 'single_line_diagram', sectionId: 'SLD.rapid-shutdown', sectionLabel: 'Rapid Shutdown Context' },
  ],
  battery_location: [
    { documentType: 'permit_validation_sheet', sectionId: 'VAL-1.registry', sectionLabel: 'Registry Status' },
    { documentType: 'permit_sheet', sectionId: 'PV-1.ess-location', sectionLabel: 'ESS Location Context' },
    { documentType: 'plan_set', sectionId: 'ESS.location-context', sectionLabel: 'ESS Layout Context' },
  ],
  service_equipment_label: [
    { documentType: 'permit_validation_sheet', sectionId: 'VAL-1.inactive-future', sectionLabel: 'Inactive Future Requirement Flags' },
  ],
};

export const REQUIREMENT_DOCUMENT_BINDINGS: Record<EngineeringRequirementId, RequirementDocumentBinding> = Object.fromEntries(
  Object.entries(ENGINEERING_REQUIREMENT_REGISTRY).map(([requirementId, definition]) => {
    const active = definition.active;
    return [requirementId, {
      requirementId: definition.requirementId,
      boundDocumentSections: baseSections[definition.requirementId],
      requiredEvidenceCategories: definition.requiredEvidenceCategories,
      optionalEvidenceCategories: definition.optionalEvidenceCategories,
      provenanceLinkage: active
        ? definition.requiredEvidenceCategories.length > 0 || definition.optionalEvidenceCategories.length > 0
          ? 'canonical_evidence_ids'
          : 'registry_status_only'
        : 'inactive_future_binding',
      missingBehaviorPolicy: !active
        ? 'not_applicable_when_inactive'
        : definition.readinessImpact === 'blocking'
          ? 'render_with_registry_warning'
          : definition.readinessImpact === 'review_required'
            ? 'defer_to_engineering_review'
            : 'render_informational_only',
      blockedRenderPolicy: !active
        ? 'never_block_document'
        : definition.readinessImpact === 'blocking'
          ? 'warn_only'
          : 'never_block_document',
      informationalOnlyPolicy: !active
        ? 'inactive_future_only'
        : definition.readinessImpact === 'informational'
          ? 'informational_when_missing'
          : 'active_requirement',
      deterministicNotes: [
        `Binding derives from ENGINEERING_REQUIREMENT_REGISTRY.${definition.requirementId}; requirement logic is not duplicated.`,
        `Bound sections: ${baseSections[definition.requirementId].map(section => section.sectionId).join(', ')}.`,
        'Missing behavior is deterministic and does not inspect binary media contents or infer geometry.',
      ],
    } satisfies RequirementDocumentBinding];
  }),
) as Record<EngineeringRequirementId, RequirementDocumentBinding>;

export function getRequirementDocumentBinding(requirementId: EngineeringRequirementId): RequirementDocumentBinding {
  return REQUIREMENT_DOCUMENT_BINDINGS[requirementId];
}

export function listRequirementDocumentBindings(): RequirementDocumentBinding[] {
  return Object.values(REQUIREMENT_DOCUMENT_BINDINGS).sort((a, b) => a.requirementId.localeCompare(b.requirementId));
}
