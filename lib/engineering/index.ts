// ============================================================
// Engineering Automation System — Public API
// ============================================================

export { buildDesignSnapshot } from './designSnapshot';
export { generateEngineeringReport } from './reportGenerator';
export type {
  DesignSnapshot,
  EngineeringReport,
  EngineeringStatus,
  SystemSummary,
  ElectricalEngineering,
  StructuralEngineering,
  EquipmentSchedule,
  EquipmentLineItem,
  PanelLayoutData,
  PermitPackage,
  EngineeringReportRow,
} from './types';