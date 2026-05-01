// ═══════════════════════════════════════════════════════════════
// Permit Engine — Public API
// ═══════════════════════════════════════════════════════════════

export { generatePermitHTML } from './generatePermit';
export { PLANSET_ENGINE_VERSION, PDF_PAGE_CONFIG } from './constants';
export type { PermitInput, CanonicalInput, CanonicalSysType } from './types';

// Section exports (for direct use / testing)
export { pageCoverSheet } from './sections/coverSheet';
export { pageSiteInformation, buildPv1Page, fetchAerialRoofData } from './sections/sitePlan';
export { pageRoofPlan, pageGroundArrayPlan, pageFencePlan, pageArrayGeometry, pageArrayPrimary } from './sections/arrayPages';
export { pageRoofStructural, pageGroundStructural, pageFenceStructural, pageStructural, pageStructuralPrimary, pageEquipmentSchedule } from './sections/structuralPages';
export { pageNECCompliance, pageConductorSchedule, pageSingleLineDiagram } from './sections/electricalPages';
export { pageWarningLabels, pageSpecSheetReference } from './sections/compliancePages';
export { pageEngineerCert, pagePELetter } from './sections/certPages';
export { pageValidationSummary } from './sections/validationPage';
