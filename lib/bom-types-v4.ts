// Neutral BOM V4 shared types. Kept separate from the BOM engine and system
// profile builders to avoid type-only import cycles between those modules.

export type BOMStageId =
  | 'array'
  | 'dc'
  | 'inverter'
  | 'ac'
  | 'structural'
  | 'monitoring'
  | 'labels';

export type BOMSystemType = 'roof' | 'ground' | 'fence';

export interface BOMLineItemV4 {
  id: string;
  stageId: BOMStageId;
  stageLabel: string;
  category: string;
  manufacturer: string;
  model: string;
  partNumber: string;
  description: string;
  quantity: number;
  unit: 'ea' | 'ft' | 'lf' | 'roll' | 'set' | 'lot';
  unitCost?: number;
  totalCost?: number;
  necReference?: string;
  derivedFrom: string;
  formula?: string;
  notes?: string;
  required: boolean;
}
