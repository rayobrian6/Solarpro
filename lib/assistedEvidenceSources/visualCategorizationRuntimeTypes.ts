export const VISUAL_CATEGORIZATION_RUNTIME_TOOL_NAME = 'deterministic-visual-categorization-runtime';
export const VISUAL_CATEGORIZATION_RUNTIME_TOOL_VERSION = '1.0.0';

export type VisualCategorizationLabel =
  | 'possible_roof_photo'
  | 'possible_attic_photo'
  | 'possible_msp_photo'
  | 'possible_inverter_photo'
  | 'possible_meter_photo'
  | 'possible_equipment_label_photo'
  | 'possible_utility_bill_photo'
  | 'possible_site_overview_photo'
  | 'possible_obstruction_photo';

export const ALLOWED_VISUAL_CATEGORIZATION_LABELS: readonly VisualCategorizationLabel[] = [
  'possible_roof_photo',
  'possible_attic_photo',
  'possible_msp_photo',
  'possible_inverter_photo',
  'possible_meter_photo',
  'possible_equipment_label_photo',
  'possible_utility_bill_photo',
  'possible_site_overview_photo',
  'possible_obstruction_photo',
] as const;

export type VisualCategorizationMethod = 'deterministic_source_context_and_byte_hash';

export interface VisualCategorizationSignal {
  signalId: string;
  label: VisualCategorizationLabel;
  confidence: number;
  evidenceBasis: readonly string[];
  limitationRefs: readonly string[];
}

export interface VisualCategorizationRuntimePayload {
  runtimePayloadHash: string;
  inputByteLength: number;
  method: VisualCategorizationMethod;
  sourceContextTextHash: string;
  byteSignature: string;
  confidence: number;
  derivedSignals: VisualCategorizationSignal[];
}

export interface VisualCategorizationExtractionInput {
  imageBytes: Uint8Array;
  sourceContextText?: string | null;
}
